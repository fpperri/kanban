'use strict';
// The option panel of the Map and of the Graph, on the plan board. One icon button at the
// top right of each view, the side the panel comes out of, opens and closes a panel on its right:
// the Graph's layouts, zoom and Options section, the Map's zoom and Options section. The Options
// section is always expanded, with no toggle of its own: the panel is what hides it. The status
// pills, the Graph's card count and its key stay in the view. The button says whether the panel is open (aria-expanded) and
// has a label. Open, a control in the panel works as it did in the row it came from (Fit, a
// layout, the zoom); closed, the panel is gone and the view has its width back, the Graph framed
// again in it. The choice is kept per view in the browser: a reload keeps it, and one view's
// choice does not change the other's. With no choice made the screen decides, open at 760 px
// and wider and closed under it, and the view follows a window that crosses the line. Under
// 760 px the panel opens over the view as a sheet, taking no width from it and adding no sideways
// scroll to it, with a close button of its own that hands focus back to the icon button.
//
// A press is a real click at the centre of the element, as a person makes it, and every wait is
// on the page, never on a fixed sleep.
//
// Page globals this scenario reads (listed in skills/web/test/browser-globals.test.js):
// graphCur.

const NARROW = 400;
const WIDE = 1800;
const PANEL_WIDTH_MIN = 200;

const corner = (view) => `(()=>{const t=document.querySelector('#${view}-view .view-panel-toggle');const m=document.querySelector('#${view}-view .${view}-main');const v=document.querySelector('#${view}-view').getBoundingClientRect();const r=t.getBoundingClientRect();const mr=m.getBoundingClientRect();return {fromRight:mr.right-r.right,fromTop:r.top-v.top}})()`;
const rect = (sel) => `(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;const r=e.getBoundingClientRect();return {l:r.left,t:r.top,r:r.right,b:r.bottom,w:r.width}})()`;

module.exports = {
  name: 'view-panel',
  board: 'plan',
  timeoutMs: 90000,
  NARROW,
  WIDE,
  async run(page) {
    const { ev, send, open, waitFor, centre, click, check, shot } = page;
    const clickOn = async (sel) => {
      const p = await centre(sel);
      if (!p) throw new Error(`nothing matches ${sel}`);
      await click(p.x, p.y);
    };
    const metrics = (width) => send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
    const load = async (url) => {
      await ev('window.__stale=true');
      await open(url);
      return waitFor('!window.__stale', 10000);
    };
    const graphDrawn = () => waitFor(`document.querySelectorAll('#graph-view .graph-node').length>3`, 10000);
    const mapDrawn = () => waitFor(`document.querySelectorAll('#map-view .card-el').length>3`, 10000);
    const toggleOf = (view) => `#${view}-view .view-panel-toggle`;
    const panelOf = (view) => `#${view}-view .view-panel`;
    const panelPresent = (view) => `!!document.querySelector('${panelOf(view)}')`;
    const panelAbsent = (view) => `!document.querySelector('${panelOf(view)}')&&!!document.querySelector('${toggleOf(view)}')`;
    const buttonState = (view) => ev(`(()=>{const t=document.querySelector('${toggleOf(view)}');if(!t)return null;return {expanded:t.getAttribute('aria-expanded'),label:t.getAttribute('aria-label'),title:t.title,`
      + `icon:!!t.querySelector('svg rect')&&!!t.querySelector('svg line'),keeps:t.hasAttribute('data-keeps-selection'),inPanel:!!t.closest('.view-panel'),`
      + `panelKeeps:!!document.querySelector('${panelOf(view)}')&&document.querySelector('${panelOf(view)}').hasAttribute('data-keeps-selection')}})()`);
    const inPanel = (sel) => ev(`[...document.querySelectorAll(${JSON.stringify(sel)})].map((e)=>!!e.closest('.view-panel'))`);
    const stageWidth = () => ev(`document.querySelector('#graph-view .graph-canvas').getBoundingClientRect().width`);
    const mapWidth = () => ev(`document.querySelector('#map-view .map-main').getBoundingClientRect().width`);
    const viewOverflow = (view) => ev(`(()=>{const v=document.querySelector('#${view}-view');return v.scrollWidth-v.clientWidth})()`);
    const GRAPH_VIEW = `(()=>{const v=graphCur.view;return {k:v.k,touched:v.touched,w:graphCur.w}})()`;
    const stored = () => ev(`localStorage.getItem('kanban.plan.viewpanel')`);

    // --- the Graph, on a wide screen -----------------------------------------------------------
    await load('/?view=graph');
    check('the Graph draws the plan board', await graphDrawn());
    check('the panel is open on a wide screen with nothing chosen', await waitFor(panelPresent('graph')) && (await stored()) === null, await stored());
    const button = await buttonState('graph');
    check('the icon button is a panel glyph with a label and says the panel is open', !!button && button.expanded === 'true' && button.label === 'Options panel' && button.icon && button.title.length > 10, button);
    check('the button is not inside the panel, and it and the panel keep the selection', !!button && !button.inPanel && button.keeps && button.panelKeeps, button);
    const layoutsIn = await inPanel('#graph-view .graph-layout-btn');
    const zoomIn = await inPanel('#graph-view .graph-zoom-btn');
    const optionsIn = await inPanel('#graph-view .graph-options');
    const graphCorner = await ev(corner('graph'));
    check('the icon button is at the top right of the view, beside the panel', graphCorner.fromRight >= 0 && graphCorner.fromRight < 40 && graphCorner.fromTop < 50, graphCorner);
    const graphOptions = await ev(`({buttons:document.querySelectorAll('#graph-view .view-panel .graph-option-btn').length,toggles:document.querySelectorAll('#graph-view .view-panel .map-section-toggle').length})`);
    check('the Options section is always expanded: all its buttons are built, with no toggle', graphOptions.buttons === 15 && graphOptions.toggles === 0, graphOptions);
    check('the layout buttons, the zoom buttons and the Options section are in the panel', layoutsIn.length === 3 && zoomIn.length === 3 && optionsIn.length === 1 && [...layoutsIn, ...zoomIn, ...optionsIn].every(Boolean), { layoutsIn, zoomIn, optionsIn });
    const staying = await ev(`['.graph-filter-toggle','.graph-count','.graph-key'].map((s)=>{const e=document.querySelector('#graph-view '+s);return !!e&&!e.closest('.view-panel')})`);
    check('the status pills, the card count and the key stay in the view', staying.every(Boolean), staying);
    const before = await ev(GRAPH_VIEW);
    await clickOn('#graph-view .graph-zoom-btn[data-graph-action=in]');
    check('Zoom in, pressed in the panel, zooms the Graph', await waitFor(`graphCur.view.k>${before.k}&&graphCur.view.touched===true`), await ev(GRAPH_VIEW));
    await clickOn('#graph-view .graph-zoom-btn[data-graph-action=fit]');
    check('Fit, pressed in the panel, frames the cards again', await waitFor(`graphCur.view.touched===false&&Math.abs(graphCur.view.k-${before.k})<0.001`), await ev(GRAPH_VIEW));
    await shot('graph-panel-open');

    // --- closed: the width comes back -----------------------------------------------------------
    const openWidth = await stageWidth();
    await clickOn(toggleOf('graph'));
    check('the button closes the panel and says so', await waitFor(panelAbsent('graph')) && (await buttonState('graph')).expanded === 'false', await buttonState('graph'));
    const shutWidth = await stageWidth();
    check('the stage has the panel\'s width back', shutWidth > openWidth + PANEL_WIDTH_MIN, { openWidth, shutWidth });
    const framed = await ev(GRAPH_VIEW);
    check('and the cards are framed in it again, the page measuring the new width', framed.touched === false && Math.abs(framed.w - shutWidth) <= 1, { framed, shutWidth });
    check('the choice is kept in the browser, for the Graph alone', (await stored()) === '{"map":null,"graph":false}', await stored());
    await shot('graph-panel-closed');
    await load('/?view=graph');
    await graphDrawn();
    check('a reload keeps the panel closed', await waitFor(panelAbsent('graph')));

    // --- open again, and a control of the panel still works -----------------------------------------
    await clickOn(toggleOf('graph'));
    check('the button opens the panel again', await waitFor(panelPresent('graph')) && (await buttonState('graph')).expanded === 'true');
    await clickOn('#graph-view .graph-layout-btn[data-layout=force]');
    check('a layout pressed in the reopened panel switches the Graph', await waitFor(`document.querySelector('#graph-view .graph-layout-btn[data-layout=force]').getAttribute('aria-pressed')==='true'&&!!document.querySelector('#graph-view .graph-kind-force')`));
    await clickOn('#graph-view .graph-layout-btn[data-layout=tiers]');
    check('and back to Tiers', await waitFor(`!!document.querySelector('#graph-view .graph-kind-tiers')&&!!document.querySelector('#graph-view .view-panel')`));

    // --- the Map ----------------------------------------------------------------------------------
    await load('/?view=map');
    check('the Map draws the plan board', await mapDrawn());
    check('the Map\'s panel is open: the Graph\'s choice is not its own', await waitFor(panelPresent('map')));
    const mapButton = await buttonState('map');
    check('the Map\'s button is the same glyph with the same label', !!mapButton && mapButton.expanded === 'true' && mapButton.label === 'Options panel' && mapButton.icon && !mapButton.inPanel, mapButton);
    const mapZoomIn = await inPanel('#map-view .map-zoom-btn');
    const mapOptionsIn = await inPanel('#map-view .map-options');
    const pillsIn = await inPanel('#map-view .status-pill, #map-view .map-filter-toggle');
    const mapCorner = await ev(corner('map'));
    check('the Map\'s icon button is at the top right of its area, beside the panel', mapCorner.fromRight >= 0 && mapCorner.fromRight < 40 && mapCorner.fromTop < 50, mapCorner);
    const mapOptions = await ev(`({groups:document.querySelectorAll('#map-view .view-panel .map-option').length,toggles:document.querySelectorAll('#map-view .view-panel .map-section-toggle').length})`);
    check('the Map\'s Options section is always expanded: its eight controls are built, with no toggle', mapOptions.groups === 8 && mapOptions.toggles === 0, mapOptions);
    check('the Map\'s zoom and Options section are in the panel, and no status pill sits in the Map', mapZoomIn.length === 3 && mapZoomIn.every(Boolean) && mapOptionsIn.length === 1 && mapOptionsIn[0] && pillsIn.length === 0, { mapZoomIn, mapOptionsIn, pillsIn });
    const pct = () => ev(`document.querySelector('#map-view .map-zoom-pct').textContent`);
    const pctBefore = await pct();
    await clickOn('#map-view .map-zoom-btn[data-zoom-action=out]');
    check('Zoom out, pressed in the panel, zooms the Map', await waitFor(`document.querySelector('#map-view .map-zoom-pct').textContent!==${JSON.stringify(pctBefore)}`), { pctBefore, now: await pct() });
    const pctZoomed = await pct();
    const mapOpenWidth = await mapWidth();
    await clickOn(toggleOf('map'));
    check('the Map\'s button closes its panel', await waitFor(panelAbsent('map')) && !(await ev(`!!document.querySelector('#map-view .map-zoom-btn')`)));
    check('the Map\'s scrolling area has the width back', (await mapWidth()) > mapOpenWidth + PANEL_WIDTH_MIN, { mapOpenWidth, now: await mapWidth() });
    check('the Map\'s choice is kept beside the Graph\'s', (await stored()) === '{"map":false,"graph":true}', await stored());
    await shot('map-panel-closed');
    await load('/?view=graph');
    await graphDrawn();
    check('the Graph\'s panel is still open', await waitFor(panelPresent('graph')));
    await load('/?view=map');
    await mapDrawn();
    check('a reload keeps the Map\'s panel closed', await waitFor(panelAbsent('map')));
    await clickOn(toggleOf('map'));
    check('the Map\'s panel opens again with the zoom the Map had', await waitFor(panelPresent('map')) && (await pct()) === pctZoomed, { pctZoomed, now: await pct() });

    // --- the screen decides until a choice is made ------------------------------------------------------
    await ev(`localStorage.removeItem('kanban.plan.viewpanel')`);
    await load('/?view=graph');
    await graphDrawn();
    check('with no choice the panel is open again', await waitFor(panelPresent('graph')));
    await metrics(NARROW);
    check('a window narrower than 760 px closes it, with no reload', await waitFor(panelAbsent('graph')), await ev('innerWidth'));
    await metrics(WIDE);
    check('and a wide one opens it again', await waitFor(panelPresent('graph')));
    await metrics(NARROW);
    await waitFor(panelAbsent('graph'));

    // --- under 760 px the panel is a sheet over the view ----------------------------------------------------
    const stageBefore = await stageWidth();
    await clickOn(toggleOf('graph'));
    check('the button opens the panel on a narrow screen', await waitFor(panelPresent('graph')));
    const sheet = await ev(`(()=>{const p=document.querySelector('${panelOf('graph')}');const ve=document.querySelector('#graph-view');const v=ve.getBoundingClientRect();const r=p.getBoundingClientRect();`
      + `const c=p.querySelector('.view-panel-close');const cr=c.getBoundingClientRect();return {position:getComputedStyle(p).position,atBottom:Math.abs(r.bottom-v.bottom)<=1,fullWidth:Math.abs(r.width-ve.clientWidth)<=1,short:r.height<=v.height*0.55,inside:r.left>=v.left-1&&r.right<=v.right+1&&r.top>=v.top-1&&r.bottom<=v.bottom+1,closeShown:cr.width>0&&cr.height>0,label:c.getAttribute('aria-label')}})()`);
    check('it lies over the view as a bottom sheet, full width, no taller than about half, with a close button of its own', sheet.position === 'absolute' && sheet.atBottom && sheet.fullWidth && sheet.short && sheet.inside && sheet.closeShown && sheet.label.length > 3, sheet);
    check('the sheet takes no width from the stage and adds no sideways scroll to the view', Math.abs((await stageWidth()) - stageBefore) <= 1 && (await viewOverflow('graph')) <= 0, { stageBefore, now: await stageWidth(), overflow: await viewOverflow('graph') });
    await shot('graph-sheet');
    await clickOn(`${panelOf('graph')} .view-panel-close`);
    check('the close button closes the sheet and hands focus to the icon button', await waitFor(`${panelAbsent('graph')}&&document.activeElement===document.querySelector('${toggleOf('graph')}')`));
    check('and the choice is kept', (await stored()) === '{"map":null,"graph":false}', await stored());

    await load('/?view=map');
    await mapDrawn();
    check('the Map\'s panel is closed on a narrow screen', await waitFor(panelAbsent('map')));
    const mapStage = await mapWidth();
    await clickOn(toggleOf('map'));
    check('the Map\'s sheet opens over its scrolling area', await waitFor(panelPresent('map')) && Math.abs((await mapWidth()) - mapStage) <= 1, { mapStage, now: await mapWidth() });
    check('and adds no sideways scroll to the Map', (await viewOverflow('map')) <= 0, await viewOverflow('map'));
    await shot('map-sheet');
  },
};
