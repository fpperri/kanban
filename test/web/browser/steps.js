'use strict';
// The step runner of the phone and phone-flip scenarios, and the touch helpers a step uses. A
// scenario of this kind is a folder of step files, each exporting run(page); the runner runs them in
// name order and gives every one a clean start, so a ticket adds a file and touches no one else's.
// Everything goes through the page the scenario is given, so test/web/browser-steps.test.js
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

// Two taps at one point, straight after each other: Chrome counts the second click as detail 2 when its
// touchStart follows the first touchEnd within about 250 ms. A pause between them goes through page.sleep,
// which a throttled run stretches 4x, so there is none.
async function doubleTap(page, x, y) {
  await tap(page, x, y);
  await tap(page, x, y);
}

// Waits out the browser's double-tap window, in real time: the window is Chrome's, so a throttled page
// does not stretch it and page.sleep, which does, is not used. A tap after this is a first tap even on
// the card the last tap landed on.
const DOUBLE_TAP_WINDOW_MS = 450;
const outwaitDoubleTap = () => new Promise((resolve) => setTimeout(resolve, DOUBLE_TAP_WINDOW_MS));

// A finger put down and kept there, for a step that does something while it is held. The page's own hold
// is 500 ms and runs on its own clock, so waiting for it is waiting in real time, never page.sleep, which a
// throttled run stretches 4x.
const LONG_PRESS_HOLD_MS = 700;
const holdDown = (page, x, y) => touchEvent(page, 'touchStart', [{ x, y }]);
const moveHeld = (page, x, y) => touchEvent(page, 'touchMove', [{ x, y }]);
const liftUp = (page) => touchEvent(page, 'touchEnd', []);
// Time that passes in the real world whatever the page's speed: a wait for the page's own timers, which a throttled page does not stretch.
const realWait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A long press: the finger goes down, stays until the page shows it has noticed (an expression the page
// answers true to, waited for with page.waitFor, so it does not depend on the machine's speed) or, with no
// expression, for 700 ms, and comes up where it went down.
async function longPress(page, x, y, { until = null } = {}) {
  await holdDown(page, x, y);
  if (until) await page.waitFor(until, 4000);
  else await realWait(LONG_PRESS_HOLD_MS);
  await liftUp(page);
}

// Waits out the page's echo of a long press (800 ms after the finger lifts), in real time like the
// double-tap window: a tap before it is the echo's, not a person's.
const PRESS_ECHO_WAIT_MS = 1200;
const outwaitPressEcho = () => realWait(PRESS_ECHO_WAIT_MS);

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

module.exports = { runSteps, freshStart, tap, doubleTap, outwaitDoubleTap, DOUBLE_TAP_WINDOW_MS, holdDown, moveHeld, liftUp, realWait, longPress, LONG_PRESS_HOLD_MS, outwaitPressEcho, PRESS_ECHO_WAIT_MS, swipe, pinch, refreshNow };
