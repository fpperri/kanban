'use strict';
// The side panel of the Map and of the Graph starts closed, and the Typing isolates and On hover show sections of the search panel
// start folded. A scenario that works a control in it opens it first,
// with the view's own button and a wait on the page, and the choice is kept for the board in the browser, so one open
// serves the reloads that follow. A scenario that checks the closed start clears the kept choice instead.

const panelIn = (view) => `!!document.querySelector('#${view}-view .view-panel')`;

// Open the view's panel on the page that is loaded, unless it already is, and wait until it stands.
async function openPanel(page, view = 'graph') {
  const { ev, waitFor } = page;
  await waitFor(`!!document.querySelector('#${view}-view .view-panel-toggle')`, 10000);
  if (!(await ev(panelIn(view)))) await ev(`document.querySelector('#${view}-view .view-panel-toggle').click()`);
  return waitFor(panelIn(view), 10000);
}

// Forget the panel's kept choice on the page that is loaded, so the next load starts closed as a new board does.
function forgetPanelChoice(page) {
  return page.ev(`Object.keys(localStorage).filter((k)=>/^kanban\..*\.viewpanel$/.test(k)).forEach((k)=>localStorage.removeItem(k))`);
}

// Unfold a section of the search panel (typing, hover) that starts folded, and wait until it stands open. The panel is open.
async function unfoldSearchSection(page, name) {
  const fold = JSON.stringify(`#search-${name}-fold`);
  await page.ev(`(()=>{const b=document.querySelector(${fold});if(b&&b.getAttribute('aria-expanded')==='false')b.click()})()`);
  return page.waitFor(`document.querySelector(${fold}).getAttribute('aria-expanded')==='true'`, 5000);
}

// Whether a page probe is about the panel's toggle or the panel itself: a stand-in page in a scenario's unit test
// answers these as an open panel.
const isPanelProbe = (expr) => /^!!document\.querySelector\('#\w+-view \.view-panel(-toggle)?'\)$/.test(expr);

module.exports = { openPanel, forgetPanelChoice, unfoldSearchSection, isPanelProbe };
