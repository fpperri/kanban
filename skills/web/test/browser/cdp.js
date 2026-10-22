'use strict';
// The browser runner's side of Chrome: a DevTools-protocol connection, the page
// a scenario drives, and the environment the scenario loop (harness.js) runs
// scenarios in. All of it takes the connection and the clock as arguments, so
// skills/web/test/browser-cdp.test.js drives it with stand-ins.

const fs = require('fs');
const path = require('path');
const { keyEvents, contextMenuExpr, sleep, boardsOf } = require('./harness');

const CALL_TIMEOUT_MS = 20000;
const EVENT_LIMIT = 5000;

// --- the connection -----------------------------------------------------------------

function connectCdp(wsUrl, { WebSocketImpl = WebSocket, callTimeoutMs = CALL_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocketImpl(wsUrl);
    let id = 0;
    let open = false;
    let closedNow = false;
    let events = [];
    const pending = new Map();
    let announceClosed;
    const closed = new Promise((r) => { announceClosed = r; });

    ws.onmessage = (m) => {
      const d = JSON.parse(m.data);
      if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } else {
        events.push(d);
        if (events.length > EVENT_LIMIT) events = events.slice(-EVENT_LIMIT);
      }
    };
    ws.onclose = () => {
      closedNow = true;
      for (const res of pending.values()) res({ error: { message: 'CDP socket closed (did Chrome exit?)' } });
      pending.clear();
      announceClosed('the DevTools socket closed');
    };
    ws.onerror = () => { if (!open) reject(new Error('CDP websocket failed')); };

    const send = (method, params = {}) => new Promise((res) => {
      if (closedNow) { res({ error: { message: 'CDP socket closed (did Chrome exit?)' } }); return; }
      const i = ++id;
      const timer = setTimeout(() => { pending.delete(i); res({ error: { message: `no answer in ${callTimeoutMs / 1000}s` } }); }, callTimeoutMs);
      pending.set(i, (d) => { clearTimeout(timer); res(d); });
      try { ws.send(JSON.stringify({ id: i, method, params })); } catch (e) { clearTimeout(timer); pending.delete(i); res({ error: { message: String(e.message || e) } }); }
    }).then((d) => { if (d.error) throw new Error(`${method}: ${JSON.stringify(d.error)}`); return d.result; });

    const ev = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(`eval: ${JSON.stringify(r.exceptionDetails).slice(0, 400)}`);
      return r.result.value;
    };

    ws.onopen = () => {
      open = true;
      resolve({
        send,
        ev,
        closed,
        takeEvents() { const out = events; events = []; return out; },
        dropEvents(match) { const before = events.length; events = events.filter((e) => !match(e)); return before - events.length; },
        close() { try { ws.close(); } catch (e) { /* closing */ } },
      });
    };
  });
}

// --- the page a scenario drives ---------------------------------------------------------

// Everything a scenario does to the browser goes through its page. Once the
// scenario is over (done, timed out or Chrome lost), every call throws, so a
// scenario that was cut off unwinds instead of carrying on against the next one.
function makePage({ cdp, base, bases = {}, scope, check, shotsDir = null, scenario = 'scenario', rate = 1 }) {
  const live = () => { if (scope.aborted) throw new Error('scenario is over'); };
  const send = async (method, params) => { live(); return cdp.send(method, params); };
  const ev = async (expr) => { live(); return cdp.ev(expr); };
  const pause = async (ms) => { live(); await sleep(ms); live(); };

  // A wait is given `rate` times its budget when the page runs `rate` times slower; this is the one place that does it.
  const scaled = (ms) => ms * rate;
  const waitFor = async (expr, ms = 4000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < scaled(ms)) {
      live();
      try { if (await cdp.ev(expr)) return true; } catch (e) { live(); /* page not ready */ }
      await sleep(40);
    }
    return false;
  };
  // A request the page was meant to have refused is logged by the browser as a console error. The step that
  // caused it names it (the status and a part of the URL) and it is taken out of what the scenario's
  // console check sees; true when that entry came.
  const expectRefusedRequest = async (status, urlPart, ms = 3000) => {
    const match = (e) => e.method === 'Log.entryAdded' && e.params.entry.level === 'error' && e.params.entry.source === 'network'
      && String(e.params.entry.text).includes(`status of ${status}`) && String(e.params.entry.url || '').includes(urlPart);
    const t0 = Date.now();
    let dropped = cdp.dropEvents(match);
    while (!dropped && Date.now() - t0 < scaled(ms)) {
      live();
      await sleep(40);
      dropped = cdp.dropEvents(match);
    }
    return dropped > 0;
  };
  const waitUntil = async (fn, ms, what) => {
    const t0 = Date.now();
    while (Date.now() - t0 < scaled(ms)) {
      live();
      if (await fn()) return;
      await sleep(100);
    }
    throw new Error(`timed out waiting for ${what}`);
  };

  const centre = (sel) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
  const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, ...extra });
  const click = async (x, y, extra = {}) => { await mouse('mousePressed', x, y, extra); await mouse('mouseReleased', x, y, extra); };
  const key = async (name, mods = {}) => { for (const e of keyEvents(name, mods)) await send('Input.dispatchKeyEvent', e); };
  const rightClick = async (selector, point) => {
    if (!(await ev(contextMenuExpr(selector, point)))) throw new Error(`right-click: nothing matches ${selector}`);
  };

  let shotN = 0;
  const shot = async (name) => {
    if (!shotsDir) return;
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(shotsDir, `${scenario}-${String(++shotN).padStart(2, '0')}-${name}.png`), Buffer.from(r.data, 'base64'));
  };

  const baseOf = (key) => {
    if (!bases[key]) throw new Error(`scenario '${scenario}' did not name board '${key}'`);
    return bases[key];
  };

  return {
    base, baseOf, bases, scope, check, send, ev, sleep: pause, rate, scaled, waitFor, waitUntil, expectRefusedRequest, centre, mouse, click, key, rightClick, shot,
    shotsOn: !!shotsDir,
    open: (pathAndQuery, boardKey) => send('Page.navigate', { url: `${boardKey ? baseOf(boardKey) : base}${pathAndQuery}` }),
  };
}

// --- the environment the scenario loop runs in ------------------------------------------------

// What counts as a console error: an uncaught exception, console.error, and an
// error-level log entry such as a failed request.
function consoleErrorsFrom(events) {
  return events
    .filter((e) => e.method === 'Runtime.exceptionThrown'
      || (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error')
      || (e.method === 'Log.entryAdded' && e.params.entry.level === 'error'))
    .map((e) => JSON.stringify(e.params).slice(0, 300));
}

// Just after a navigation Chrome may still be swapping the new page in, and
// it refuses the history reset until it has, so the reset is tried again
// until it takes or the time is up.
async function resetHistory(cdp, ms) {
  const until = Date.now() + ms;
  for (;;) {
    try { return await cdp.send('Page.resetNavigationHistory'); } catch (e) {
      if (!/Not attached to an active page/.test(e.message) || Date.now() >= until) throw e;
      await sleep(50);
    }
  }
}

// `boards` maps a board key to { base }; resetBoard(key) puts that board's
// cards back as they were. Every scenario starts from the same place: no page,
// an empty tab history, the board's own browser storage cleared, the board
// restored, a fixed window, a page that counts as focused, no leftover console events. That is what makes the
// order scenarios run in not matter. Chrome keeps at most 50 history entries,
// so without the reset a scenario that counts history steps late in a run
// would see none added.
function createBrowserEnv({ cdp, boards, resetBoard, shotsDir = null, chromeExited, historyResetMs = 3000, rate = 1 }) {
  const gone = Promise.race([
    chromeExited.then((why) => `Chrome ${why}`),
    cdp.closed,
  ]);
  return {
    gone,
    async begin(sc, ctx) {
      const keys = boardsOf(sc);
      for (const k of keys) {
        if (!boards[k]) throw new Error(`scenario '${sc.name}' names board '${k}', which the run did not start`);
      }
      await cdp.send('Page.navigate', { url: 'about:blank' });
      await resetHistory(cdp, historyResetMs * rate);
      for (const k of keys) {
        await cdp.send('Storage.clearDataForOrigin', { origin: new URL(boards[k].base).origin, storageTypes: 'all' });
        await resetBoard(k);
      }
      // Wide enough that the Graph's stage, with the option panel open beside it, still holds the fixture's Unnested table
      // and the names outside its rim, which the fit leaves no room for.
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1800, height: 1000, deviceScaleFactor: 1, mobile: false });
      await cdp.send('Emulation.setEmulatedMedia', { features: [] });
      // A slow machine: the page's JavaScript runs `rate` times slower (see cpuThrottleRate in harness.js), to find the
      // step that only passes because the page is fast (CI's runner is slower than a desk).
      if (rate > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate });
      // The phone scenario turns touch on; no other scenario starts with it.
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
      // A tab nobody has clicked in is not focused, and a focus() on one of its elements fires no focus event. Focus
      // emulation makes it fire them, which the search panel opens on.
      await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
      cdp.takeEvents();
      const bases = Object.fromEntries(keys.map((k) => [k, boards[k].base]));
      return makePage({ cdp, base: boards[sc.board].base, bases, scope: ctx.scope, check: ctx.check, shotsDir, scenario: sc.name, rate });
    },
    async end(sc, rec) {
      if (rec.status !== 'FAIL' || !shotsDir) return;
      const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(shotsDir, `FAIL-${sc.name}.png`), Buffer.from(r.data, 'base64'));
    },
    async consoleErrors() { return consoleErrorsFrom(cdp.takeEvents()); },
  };
}

module.exports = { connectCdp, makePage, createBrowserEnv, consoleErrorsFrom, resetHistory };
