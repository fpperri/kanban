'use strict';
// The step runner of the phone and phone-flip scenarios, and the touch helpers a step uses. A
// scenario of this kind is a folder of step files, each exporting run(page); the runner runs them in
// name order and gives every one a clean start, so a ticket adds a file and touches no one else's.
// Everything goes through the page the scenario is given, so skills/web/test/browser-steps.test.js
// drives it with a stand-in.

const fs = require('fs');
const path = require('path');
const { resetHistory } = require('./cdp');

const HISTORY_RESET_MS = 3000;

// A clean page for one step: nothing loaded, no tab history, no browser storage on any board the
// scenario names, and the scenario's start size with touch on or off.
async function freshStart(page, start) {
  await page.send('Page.navigate', { url: 'about:blank' });
  await resetHistory(page, HISTORY_RESET_MS);
  for (const base of Object.values(page.bases)) {
    await page.send('Storage.clearDataForOrigin', { origin: new URL(base).origin, storageTypes: 'all' });
  }
  await page.send('Emulation.setDeviceMetricsOverride', { width: start.width, height: start.height, deviceScaleFactor: 1, mobile: !!start.touch });
  await page.send('Emulation.setTouchEmulationEnabled', start.touch ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
}

async function runSteps(page, dir, start) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort();
  for (const f of files) {
    await freshStart(page, start);
    await require(path.join(dir, f)).run(page);
  }
}

const touchEvent = (page, type, points) => page.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p, id) => ({ x: p.x, y: p.y, id })) });

async function tap(page, x, y) {
  await touchEvent(page, 'touchStart', [{ x, y }]);
  await touchEvent(page, 'touchEnd', []);
}

async function swipe(page, from, to, { steps = 8 } = {}) {
  await touchEvent(page, 'touchStart', [from]);
  for (let i = 1; i <= steps; i++) {
    await touchEvent(page, 'touchMove', [{ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps }]);
  }
  await touchEvent(page, 'touchEnd', []);
}

// Two fingers either side of `centre` on a horizontal line, `from` px apart at first and `to` px apart at the end.
async function pinch(page, centre, { from, to, steps = 8 }) {
  const fingers = (gap) => [{ x: centre.x - gap / 2, y: centre.y }, { x: centre.x + gap / 2, y: centre.y }];
  await touchEvent(page, 'touchStart', fingers(from));
  for (let i = 1; i <= steps; i++) await touchEvent(page, 'touchMove', fingers(from + ((to - from) * i) / steps));
  await touchEvent(page, 'touchEnd', []);
}

// Runs one refresh of the board now, the one the 5-second poll runs, and waits until the page has applied
// its payload (the tick skips itself while an interaction holds the page, which this then reports as false).
async function refreshNow(page) {
  await page.ev(`(()=>{if(window.__applied===undefined){window.__applied=0;const o=applyBoardData;window.applyBoardData=function(...a){window.__applied++;return o.apply(this,a)}}return true})()`);
  const before = await page.ev('window.__applied');
  await page.ev('autoRefreshTick().then(()=>true)');
  return page.waitFor(`window.__applied>${before}`, 5000);
}

module.exports = { runSteps, freshStart, tap, swipe, pinch, refreshNow };
