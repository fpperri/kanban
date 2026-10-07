#!/usr/bin/env node
'use strict';
// Browser smoke test for the web app's Graph view.
//
// Serves a copy of ./fixture with skills/web/scripts/server.js, launches a
// headless Chrome (or Edge/Chromium) and drives the real page over the Chrome
// DevTools Protocol: layouts, pan/zoom, selection, force drag, search, reload.
// No dependencies; needs Node >= 22 (global fetch and WebSocket).
//
// Run:    npm run test:browser
//         node skills/web/test/browser/run.js [--shots <dir>]
// Chrome: found automatically; set CHROME_PATH to override or to point at a
//         browser in a non-standard place.
// --shots <dir> saves a screenshot per step (default: none).
// Exit:   0 all checks passed, 1 a check failed, 2 no browser found, 3 harness error.
//
// Deliberately NOT part of `npm test`: it needs a real browser and takes a
// while, so it lives outside the skills/web/test/*.test.js glob.

const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const IS_WIN = process.platform === 'win32';
const SERVER_JS = path.join(__dirname, '..', '..', 'scripts', 'server.js');
const FIXTURE = path.join(__dirname, 'fixture');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
  const out = { shots: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--shots') out.shots = path.resolve(argv[++i] || '');
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  return out;
}

function findChrome() {
  const env = process.env.CHROME_PATH;
  if (env) return fs.existsSync(env) ? env : null;
  const cands = [];
  if (IS_WIN) {
    for (const base of [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]) {
      if (!base) continue;
      cands.push(path.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'));
      cands.push(path.join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    }
  } else if (process.platform === 'darwin') {
    cands.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
  }
  for (const c of cands) if (fs.existsSync(c)) return c;
  if (!IS_WIN) {
    for (const dir of (process.env.PATH || '').split(path.delimiter)) {
      for (const n of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'chrome', 'microsoft-edge']) {
        const p = path.join(dir, n);
        try { fs.accessSync(p, fs.constants.X_OK); return p; } catch (e) { /* next */ }
      }
    }
  }
  return null;
}

function freePorts(n) {
  const servers = [];
  const ports = [];
  const one = () => new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { ports.push(s.address().port); servers.push(s); resolve(); });
  });
  return (async () => {
    for (let i = 0; i < n; i++) await one();
    await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
    return ports;
  })();
}

const tracked = [];
const tmpDirs = [];
let cleanupPromise = null;

function track(name, child) {
  const rec = { name, child, out: '' };
  const grab = (d) => { rec.out = (rec.out + d).slice(-4000); };
  if (child.stdout) child.stdout.on('data', grab);
  if (child.stderr) child.stderr.on('data', grab);
  tracked.push(rec);
  return rec;
}

function killTree(child) {
  if (!child || !child.pid || child.killedByHarness) return;
  child.killedByHarness = true;
  try {
    if (IS_WIN) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    else {
      try { process.kill(-child.pid, 'SIGKILL'); } catch (e) { process.kill(child.pid, 'SIGKILL'); }
    }
  } catch (e) { /* already gone */ }
}

function rmDir(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); } catch (e) { /* reported by the caller */ }
  return !fs.existsSync(dir);
}

async function answering(url) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(800) });
    return true;
  } catch (e) { return false; }
}

async function cleanup(ports) {
  if (cleanupPromise) return cleanupPromise;
  cleanupPromise = (async () => {
    for (const t of tracked) killTree(t.child);
    const urls = [];
    if (ports && ports.server) urls.push([`server port ${ports.server}`, `http://127.0.0.1:${ports.server}/`]);
    if (ports && ports.cdp) urls.push([`Chrome debug port ${ports.cdp}`, `http://127.0.0.1:${ports.cdp}/json/version`]);
    for (const [label, url] of urls) {
      let up = true;
      for (let i = 0; i < 25 && up; i++) {
        up = await answering(url);
        if (up) await sleep(200);
      }
      if (up) console.log(`WARNING: ${label} is still answering after cleanup`);
    }
    for (const d of tmpDirs) if (!rmDir(d)) console.log(`WARNING: could not remove temp dir ${d}`);
  })();
  return cleanupPromise;
}

let activePorts = null;
process.on('exit', () => {
  for (const t of tracked) killTree(t.child);
  for (const d of tmpDirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* best effort */ } }
});
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, async () => { await cleanup(activePorts); process.exit(130); });
}
const fatal = async (e) => {
  console.error(`HARNESS ERROR: ${e && e.stack ? e.stack : e}`);
  await cleanup(activePorts);
  process.exit(3);
};
process.on('uncaughtException', fatal);
process.on('unhandledRejection', fatal);

async function waitUntil(fn, ms, what) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return;
    await sleep(100);
  }
  throw new Error(`timed out waiting for ${what}`);
}

async function drive(base, cdpPort, shotsDir) {
  const exited = (rec) => rec.child.exitCode !== null || rec.child.signalCode !== null;
  const chromeRec = tracked.find((t) => t.name === 'chrome');
  let page = null;
  await waitUntil(async () => {
    if (exited(chromeRec)) throw new Error(`Chrome exited early: ${chromeRec.out}`);
    try {
      const targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json`, { signal: AbortSignal.timeout(2000) })).json();
      page = targets.find((t) => t.type === 'page');
    } catch (e) { return false; }
    return !!page;
  }, 20000, 'Chrome to expose a page target');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('CDP websocket failed')); });
  let id = 0;
  const pending = new Map();
  const events = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } else events.push(d);
  };
  ws.onclose = () => {
    for (const res of pending.values()) res({ error: { message: 'CDP socket closed (did Chrome exit?)' } });
    pending.clear();
  };
  const send = (method, params = {}) => new Promise((res) => {
    const i = ++id;
    const timer = setTimeout(() => { pending.delete(i); res({ error: { message: 'no answer in 20s' } }); }, 20000);
    pending.set(i, (d) => { clearTimeout(timer); res(d); });
    try { ws.send(JSON.stringify({ id: i, method, params })); } catch (e) { clearTimeout(timer); pending.delete(i); res({ error: { message: String(e.message || e) } }); }
  }).then((d) => { if (d.error) throw new Error(`${method}: ${JSON.stringify(d.error)}`); return d.result; });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('eval: ' + JSON.stringify(r.exceptionDetails).slice(0, 400));
    return r.result.value;
  };

  const results = [];
  const check = (name, ok, detail) => {
    results.push({ name, ok: !!ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : '  ' + JSON.stringify(detail)}`);
  };
  let shotN = 0;
  const shot = async (name) => {
    if (!shotsDir) return;
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(shotsDir, `${String(++shotN).padStart(2, '0')}-${name}.png`), Buffer.from(r.data, 'base64'));
  };
  const waitFor = async (expr, ms = 4000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      try { if (await ev(expr)) return true; } catch (e) { /* page not ready */ }
      await sleep(40);
    }
    return false;
  };
  const centre = (sel) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
  const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, ...extra });
  const click = async (x, y, extra = {}) => { await mouse('mousePressed', x, y, extra); await mouse('mouseReleased', x, y, extra); };
  const world = () => ev(`(()=>{const w=document.querySelector('.graph-world');if(!w)return null;const m=/translate\\(([-\\d.e]+) ([-\\d.e]+)\\) scale\\(([-\\d.e]+)\\)/.exec(w.getAttribute('transform'));return m?{x:+m[1],y:+m[2],k:+m[3]}:{raw:w.getAttribute('transform')}})()`);
  const waitWorld = async (pred, ms = 4000) => {
    const t0 = Date.now();
    let w = await world();
    while (Date.now() - t0 < ms) {
      w = await world();
      if (w && pred(w)) return w;
      await sleep(40);
    }
    return w;
  };
  const stats = () => ev(`(()=>({nodes:document.querySelectorAll('.graph-node').length,links:document.querySelectorAll('.graph-link').length,bad:[...document.querySelectorAll('#graph-view [transform],#graph-view [d],#graph-view circle')].filter(e=>/NaN|Infinity|undefined/.test((e.getAttribute('transform')||'')+(e.getAttribute('d')||'')+(e.getAttribute('r')||'')+(e.getAttribute('cx')||''))).length,layout:(document.querySelector('.graph-layout-btn[aria-pressed=true]')||{dataset:{}}).dataset.layout,count:(document.querySelector('.graph-count')||{}).textContent,archivePill:(document.querySelector('.graph-filter-toggle[data-col=archive]')||{getAttribute(){return null}}).getAttribute('aria-pressed')}))()`);
  const layoutIs = (l) => `(document.querySelector('.graph-layout-btn[aria-pressed=true]')||{dataset:{}}).dataset.layout===${JSON.stringify(l)}&&document.querySelectorAll('.graph-node').length>0`;
  const pickLayout = async (l) => {
    await ev(`document.querySelector('.graph-layout-btn[data-layout=${l}]').click()`);
    return waitFor(layoutIs(l));
  };
  const nodeCount = () => ev(`document.querySelectorAll('.graph-node').length`);
  const snap = () => ev(`(()=>{const o={};for(const n of document.querySelectorAll('.graph-node')){const m=/translate\\(([-\\d.e]+) ([-\\d.e]+)\\)/.exec(n.getAttribute('transform'));o[n.dataset.id]={x:+m[1],y:+m[2]}}return o})()`);
  const settled = async (ms = 6000) => {
    let prev = await snap();
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      await sleep(120);
      const cur = await snap();
      const d = Math.max(...Object.keys(cur).map((k) => (prev[k] ? Math.hypot(cur[k].x - prev[k].x, cur[k].y - prev[k].y) : 99)));
      prev = cur;
      if (d < 0.2) return cur;
    }
    return prev;
  };
  const search = async (v) => ev(`(()=>{const i=document.getElementById('search-input');i.value=${JSON.stringify(v)};i.dispatchEvent(new Event('input',{bubbles:true}))})()`);

  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });

  await send('Page.navigate', { url: `${base}/?view=graph` });
  check('graph renders after deep link ?view=graph', await waitFor(`document.querySelectorAll('.graph-node').length>0`, 10000));
  await waitFor(layoutIs('tiers'));
  let s = await stats();
  check('default layout is tiers', s.layout === 'tiers', s);
  check('no NaN/Infinity in drawn geometry', s.bad === 0, s.bad);
  check('every node is card-el with data-id', await ev(`[...document.querySelectorAll('.graph-node')].every(n=>n.classList.contains('card-el')&&/^\\d+$/.test(n.dataset.id))`));
  check('graph container visible and board hidden', await ev(`!document.getElementById('graph-view').classList.contains('hidden')&&document.getElementById('board').classList.contains('hidden')`));
  check('toggle button reads Board view and is pressed', await ev(`(()=>{const b=document.getElementById('graph-toggle-btn');return b.getAttribute('aria-pressed')==='true'&&/Board view/.test(b.textContent)})()`));
  const tiersNodes = s.nodes;
  await shot('tiers');

  await pickLayout('force');
  s = await stats();
  check('force layout renders', s.layout === 'force' && s.nodes > 0 && s.bad === 0, s);
  await shot('force');

  await pickLayout('status');
  s = await stats();
  check('status layout renders', s.layout === 'status' && s.nodes > 0 && s.bad === 0, s);
  const order = await ev(`(()=>{const ls=[...document.querySelectorAll('.graph-ring-label')].map(t=>({t:t.textContent,r:-(+t.getAttribute('y'))-3,cx:(+t.getAttribute('x'))-4}));const cx=Math.min(...ls.map(l=>l.cx));return ls.filter(l=>l.cx===cx).sort((a,b)=>a.r-b.r).map(l=>l.t)})()`);
  check('status rings run done, doing, todo, backlog from the centre out', Array.isArray(order) && order.length >= 4 && order.slice(0, 4).map((t) => t.split(' ')[0]).join(',') === 'done,doing,todo,backlog', order);
  await shot('status');
  const before = s.nodes;
  await ev(`document.querySelector('.graph-filter-toggle[data-col=archive]').click()`);
  await waitFor(`document.querySelectorAll('.graph-node').length>${before}`);
  s = await stats();
  check('archive pill adds archived cards as a second clump', s.nodes > before && (await ev(`document.querySelectorAll('.graph-title').length`)) === 2, { before, after: s.nodes });
  await shot('status-archive');

  await pickLayout('tiers');
  await ev(`document.querySelector('.graph-filter-toggle[data-col=archive]').click()`);
  await waitFor(`document.querySelectorAll('.graph-node').length===${tiersNodes}`);

  const hub = await ev(`(()=>{let best=null;for(const n of document.querySelectorAll('.graph-node')){const sc=n.classList.contains('graph-hub')?1:0;if(!best||sc>best.sc)best={sc,id:n.dataset.id};}return best&&best.id})()`);
  await ev(`document.querySelector('.graph-node[data-id="${hub}"]').dispatchEvent(new MouseEvent('mouseover',{bubbles:true}))`);
  check('hover dims the graph and marks neighbours', await ev(`document.querySelector('.graph-canvas').classList.contains('graph-dim')&&document.querySelectorAll('.graph-near').length>=1`));
  await shot('hover');
  await ev(`document.querySelector('.graph-node[data-id="${hub}"]').dispatchEvent(new MouseEvent('mouseout',{bubbles:true,relatedTarget:document.body}))`);
  check('mouseout clears the focus', await ev(`!document.querySelector('.graph-canvas').classList.contains('graph-dim')&&document.querySelectorAll('.graph-near').length===0`));

  const w0 = await world();
  const pt = await centre('.graph-stage');
  const rect = await ev(`(()=>{const r=document.querySelector('.graph-canvas').getBoundingClientRect();return {l:r.left,t:r.top,r:r.right,b:r.bottom}})()`);
  const bg = { x: rect.r - 14, y: rect.b - 14 };
  check('background pixel is not a node', await ev(`!document.elementFromPoint(${bg.x},${bg.y}).closest('.card-el')`));
  const first = await ev(`document.querySelector('.graph-node').dataset.id`);
  const circleSel = `.graph-node[data-id="${first}"] circle`;
  let nc = await centre(circleSel);
  await click(nc.x, nc.y, { modifiers: 2 });
  await waitFor(`selectedIds.size>=1`);
  const sel1 = await ev(`selectedIds.size`);
  await mouse('mousePressed', bg.x, bg.y); await mouse('mouseMoved', bg.x - 40, bg.y - 20, { buttons: 1 });
  check('isDragging is set mid-pan', await ev(`isDragging===true`));
  await mouse('mouseMoved', bg.x - 120, bg.y - 60, { buttons: 1 }); await mouse('mouseReleased', bg.x - 120, bg.y - 60);
  const w1 = await waitWorld((w) => Math.abs((w.x - w0.x) + 120) < 3 && Math.abs((w.y - w0.y) + 60) < 3);
  check('drag pans the world', Math.abs((w1.x - w0.x) + 120) < 3 && Math.abs((w1.y - w0.y) + 60) < 3, { w0, w1 });
  check('isDragging cleared after the pan', await waitFor(`isDragging===false`));
  const selAfterPan = await ev(`selectedIds.size`);
  check('a pan does not clear the selection (phantom click swallowed)', selAfterPan === sel1 && sel1 >= 1, { sel1, after: selAfterPan });
  await click(bg.x, bg.y);
  await waitFor(`selectedIds.size===0`);

  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: pt.x, y: pt.y, deltaX: 0, deltaY: -240 });
  const w2 = await waitWorld((w) => w.k > w1.k);
  check('wheel zooms in', w2.k > w1.k, { k1: w1.k, k2: w2.k });
  await ev(`document.querySelector('.graph-zoom-btn[data-graph-action=out]').click()`);
  const w3 = await waitWorld((w) => w.k < w2.k);
  check('zoom out button zooms out', w3.k < w2.k, { k2: w2.k, k3: w3.k });
  await ev(`document.querySelector('.graph-zoom-btn[data-graph-action=fit]').click()`);
  const w4 = await waitWorld((w) => Math.abs(w.k - w0.k) < 0.02);
  check('Fit restores the fitted view', Math.abs(w4.k - w0.k) < 0.02, { w0, w4 });
  await shot('after-fit');
  nc = await centre(circleSel);
  await click(nc.x, nc.y, { modifiers: 2 });
  await waitFor(`selectedIds.size>=1`);
  const selBefore = await ev(`selectedIds.size`);
  const zin = await centre('.graph-zoom-btn[data-graph-action=in]');
  const kFit = (await world()).k;
  await click(zin.x, zin.y);
  await waitWorld((w) => w.k > kFit);
  const selAfterZoom = await ev(`selectedIds.size`);
  check('clicking a zoom button keeps a multi-selection', selBefore >= 1 && selAfterZoom === selBefore, { selBefore, now: selAfterZoom });
  const wz = await world();
  await ev(`document.querySelector('.graph-layout-btn[aria-pressed=true]').click()`);
  const wz2 = await world();
  check('clicking the active layout keeps the zoomed view', wz.k > kFit && Math.abs(wz.k - wz2.k) < 1e-6 && Math.abs(wz.x - wz2.x) < 0.5, { kFit, wz, wz2 });
  check('a zoom-button click does not leave focus on a poll-blocking control', await ev(`!document.activeElement.classList.contains('graph-zoom-btn')`));
  await ev(`document.querySelector('.graph-zoom-btn[data-graph-action=fit]').click()`);
  await waitWorld((w) => Math.abs(w.k - w0.k) < 0.02);

  nc = await centre(circleSel);
  await click(nc.x, nc.y);
  await waitFor(`selectedIds.size===1`);
  await sleep(250);
  const url0 = await ev(`location.search`);
  check('plain click selects and does NOT open the card', !/card=\d+/.test(url0) && (await ev(`selectedIds.size`)) === 1 && (await ev(`document.querySelectorAll('.graph-node.selected').length`)) === 1, { url0 });
  check('a selected card keeps its relations lit', await ev(`document.querySelector('.graph-canvas').classList.contains('graph-dim')&&document.querySelectorAll('.graph-node.graph-near').length>=1`));
  await mouse('mouseMoved', bg.x, bg.y);
  const hoverGone = await waitFor(`hoveredId===null`);
  check('the selection focus survives the pointer leaving', hoverGone && await ev(`document.querySelector('.graph-canvas').classList.contains('graph-dim')`));
  await shot('selected');
  await click(nc.x, nc.y, { clickCount: 1 });
  await click(nc.x, nc.y, { clickCount: 2 });
  const opened = await waitFor(`/card=\\d+/.test(location.search)`, 2500);
  check('double click opens the card (URL gains card=)', opened, await ev(`location.search`));
  await shot('detail-open');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await waitFor(`!/card=\\d+/.test(location.search)`, 2000);
  await click(bg.x, bg.y);
  check('clicking empty canvas clears the selection', await waitFor(`selectedIds.size===0`));

  const nBefore = await nodeCount();
  await search('zephyr');
  await waitFor(`document.querySelectorAll('.graph-node').length<${nBefore}`);
  const nSearch = await nodeCount();
  check('search narrows the graph', nSearch < nBefore && nSearch > 0, { nBefore, nSearch });
  await search('');
  check('clearing search restores the graph', await waitFor(`document.querySelectorAll('.graph-node').length===${nBefore}`));

  await pickLayout('force');
  await settled();
  const hubInfo = await ev(`(()=>{let best=null;for(const n of graphCur.model.nodes){if(!best||n.deg>best.deg)best=n}return {id:best.id,near:[...graphNeighbours(graphCur.model,best.id)].filter(i=>i!==best.id)}})()`);
  const p0 = await snap();
  const hc = await centre(`.graph-node[data-id="${hubInfo.id}"] circle`);
  const k0 = (await world()).k;
  const endX = hc.x + 180, endY = hc.y + 90;
  await mouse('mousePressed', hc.x, hc.y);
  for (let i = 1; i <= 12; i++) await mouse('mouseMoved', hc.x + (180 * i) / 12, hc.y + (90 * i) / 12, { buttons: 1 });
  check('isDragging is true during a node drag', await waitFor(`isDragging===true`));
  let mid = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 3000) {
    mid = await centre(`.graph-node[data-id="${hubInfo.id}"] circle`);
    if (Math.hypot(mid.x - endX, mid.y - endY) < 4) break;
    await sleep(40);
  }
  check('the dragged card sits under the pointer', Math.hypot(mid.x - endX, mid.y - endY) < 4, { mid, endX, endY });
  check('the svg is marked as dragging', await ev(`document.querySelector('.graph-canvas').classList.contains('graph-dragging')`));
  await mouse('mouseReleased', endX, endY);
  const clean = await waitFor(`isDragging===false&&!document.querySelector('.graph-canvas').classList.contains('graph-dragging')`);
  const p1 = await settled();
  const disp = (i) => Math.hypot(p1[i].x - p0[i].x, p1[i].y - p0[i].y);
  const dir = { x: 180 / k0, y: 90 / k0 };
  const pulled = hubInfo.near.filter((i) => disp(i) > 20 && ((p1[i].x - p0[i].x) * dir.x + (p1[i].y - p0[i].y) * dir.y) > 0);
  check('related cards are pulled along with the dragged card', pulled.length >= 1, { near: hubInfo.near.length, pulled: pulled.length, maxNearDisp: Math.max(...hubInfo.near.map(disp)) });
  const others = Object.keys(p0).filter((i) => Number(i) !== hubInfo.id && !hubInfo.near.includes(Number(i)));
  const meanNear = hubInfo.near.reduce((a, i) => a + disp(i), 0) / Math.max(1, hubInfo.near.length);
  const meanOther = others.reduce((a, i) => a + disp(i), 0) / Math.max(1, others.length);
  check('unrelated cards move far less than related ones', meanOther < meanNear, { meanNear, meanOther });
  check('the drag ended cleanly (isDragging false, no dragging class)', clean);
  check('a drag does not leave a selection behind (phantom click swallowed)', (await ev(`selectedIds.size`)) === 0);
  await shot('after-drag');
  await ev(`(async()=>{await autoRefreshTick();await autoRefreshTick();})()`);
  await sleep(100);
  const p2 = await snap();
  const drift = Math.max(...Object.keys(p1).map((i) => Math.hypot(p2[i].x - p1[i].x, p2[i].y - p1[i].y)));
  check('the dragged arrangement survives the 5s poll', drift < 0.5, { drift });

  await pickLayout('tiers');
  const tp0 = await snap();
  const tw0 = await world();
  const tc = await centre(`.graph-node[data-id="${hubInfo.id}"] circle`);
  await mouse('mousePressed', tc.x, tc.y); await mouse('mouseMoved', tc.x + 60, tc.y + 30, { buttons: 1 }); await mouse('mouseMoved', tc.x + 120, tc.y + 60, { buttons: 1 }); await mouse('mouseReleased', tc.x + 120, tc.y + 60);
  await sleep(150);
  const tp1 = await snap();
  const tw1 = await world();
  check('in Tiers a card does not drag and the view does not pan from it', Math.hypot(tp1[hubInfo.id].x - tp0[hubInfo.id].x, tp1[hubInfo.id].y - tp0[hubInfo.id].y) < 0.01 && Math.abs(tw1.x - tw0.x) < 0.5, { tw0, tw1 });
  await pickLayout('force');
  await settled();
  await mouse('mousePressed', bg.x, bg.y); await mouse('mouseMoved', bg.x - 90, bg.y - 40, { buttons: 1 }); await mouse('mouseReleased', bg.x - 90, bg.y - 40);
  await waitFor(`isDragging===false`);
  const wp = await world();
  await ev(`(async()=>{await autoRefreshTick();await autoRefreshTick();})()`);
  await sleep(100);
  const wq = await world();
  check('the 5s poll keeps the user pan', Math.abs(wp.x - wq.x) < 0.5 && Math.abs(wp.k - wq.k) < 1e-6, { wp, wq });

  await send('Page.reload');
  await waitFor(layoutIs('force'), 10000);
  s = await stats();
  check('layout choice survives a reload (view.mode + graph.layout)', s.layout === 'force' && s.nodes > 0, s);

  await ev(`document.getElementById('graph-toggle-btn').click()`);
  check('toggle returns to the board', await waitFor(`document.getElementById('graph-view').classList.contains('hidden')&&!document.getElementById('board').classList.contains('hidden')`));

  await send('Page.navigate', { url: `${base}/?view=graph` });
  await waitFor(`document.querySelectorAll('.graph-node').length>0`, 10000);
  await pickLayout('tiers');
  if (shotsDir) {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
    await sleep(300);
    await shot('dark-tiers');
    await pickLayout('status');
    await shot('dark-status');
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
    await sleep(300);
    await shot('light-status');
    await pickLayout('tiers');
    await shot('light-tiers');
  }
  await ev(`(()=>{for(let i=0;i<5;i++)renderGraphView();return 1})()`);
  const errs = events.filter((e) => (e.method === 'Runtime.exceptionThrown') || (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error') || (e.method === 'Log.entryAdded' && e.params.entry.level === 'error'))
    .map((e) => JSON.stringify(e.params).slice(0, 300));
  check('no console errors or exceptions', errs.length === 0, errs);
  try { ws.close(); } catch (e) { /* closing */ }
  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const chrome = findChrome();
  if (!chrome) {
    console.error('No Chrome/Chromium/Edge found: set CHROME_PATH to a browser executable.');
    return 2;
  }
  if (typeof WebSocket === 'undefined') throw new Error('Node >= 22 is required (global WebSocket)');
  if (args.shots) fs.mkdirSync(args.shots, { recursive: true });

  const [serverPort, cdpPort] = await freePorts(2);
  activePorts = { server: serverPort, cdp: cdpPort };
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-browser-'));
  tmpDirs.push(root);
  const boardDir = path.join(root, 'board');
  const profileDir = path.join(root, 'profile');
  fs.cpSync(FIXTURE, boardDir, { recursive: true });
  const cfgPath = path.join(boardDir, 'config.yaml');
  fs.writeFileSync(cfgPath, `port: ${serverPort}\n${fs.readFileSync(cfgPath, 'utf8')}`);

  const server = track('server', spawn(process.execPath, [SERVER_JS, boardDir, String(serverPort)], {
    stdio: ['ignore', 'pipe', 'pipe'], detached: !IS_WIN, windowsHide: true,
  }));
  const base = `http://127.0.0.1:${serverPort}`;
  await waitUntil(async () => {
    if (server.child.exitCode !== null) throw new Error(`server exited early: ${server.out}`);
    try { return (await fetch(`${base}/`, { signal: AbortSignal.timeout(2000) })).status === 200; } catch (e) { return false; }
  }, 15000, 'the server to answer HTTP 200');
  const board = await (await fetch(`${base}/api/board`, { signal: AbortSignal.timeout(5000) })).json();
  if (board.projectName !== 'fixture') throw new Error(`port ${serverPort} is serving board '${board.projectName}', not the fixture`);

  const chromeArgs = ['--headless=new', '--disable-gpu', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profileDir}`,
    '--window-size=1600,1000', '--no-first-run', '--no-default-browser-check'];
  if (typeof process.getuid === 'function' && process.getuid() === 0) chromeArgs.push('--no-sandbox');
  chromeArgs.push('about:blank');
  track('chrome', spawn(chrome, chromeArgs, { stdio: ['ignore', 'pipe', 'pipe'], detached: !IS_WIN, windowsHide: true }));

  const results = await drive(base, cdpPort, args.shots);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed (${results.length} checks)`);
  return failed ? 1 : 0;
}

const watchdog = setTimeout(() => fatal(new Error('the run took longer than 120s')), 120000);
watchdog.unref();

(async () => {
  let code;
  try { code = await main(); } catch (e) { console.error(`HARNESS ERROR: ${e && e.message ? e.message : e}`); code = 3; }
  await cleanup(activePorts);
  process.exit(code);
})();
