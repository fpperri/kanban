'use strict';
// The browser runner's harness: everything a scenario stands on, kept apart
// from the scenarios so it can be unit tested without a browser (see the
// skills/web/test/browser-*.test.js files that require it, browser-harness.test.js
// first).
//
//   command line     parseArgs, selectScenarios, withFault
//   Chrome           chromeArgs (the sandbox switch)
//   input            keyEvents, contextMenuExpr
//   processes        createRegistry: what a run starts, and ending all of it
//   starting Chrome  startChromeUntilPage, waitForPageTarget: a Chrome that lists a
//                    page, started again once if it never does
//   the loop         runScenarios: a timeout and a console-error check for each
//                    scenario, and whatever happens to one recorded under its name;
//                    summaryLines: its report
//
// No dependencies; needs Node >= 22 (global fetch and WebSocket).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const IS_WIN = process.platform === 'win32';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const EXIT = { OK: 0, FAILED: 1, NO_BROWSER: 2, HARNESS: 3 };

// --- command line ----------------------------------------------------------------

function parseFault(text) {
  if (text === 'kill-chrome') return { kind: 'kill-chrome' };
  const m = /^throw:(.+)$/.exec(text);
  if (m) return { kind: 'throw', scenario: m[1] };
  throw new Error(`unknown fault '${text}': throw:<scenario> or kill-chrome`);
}

function parseArgs(argv) {
  const out = { shots: null, only: [], reverse: false, list: false, fault: null, plugin: null };
  const value = (i, what) => {
    if (i >= argv.length || argv[i].startsWith('--')) throw new Error(`${argv[i - 1]} needs ${what}`);
    return argv[i];
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--shots') out.shots = path.resolve(value(++i, 'a directory'));
    else if (a === '--only') out.only.push(...value(++i, 'a scenario name').split(',').filter(Boolean));
    else if (a === '--reverse') out.reverse = true;
    else if (a === '--list') out.list = true;
    else if (a === '--fault') out.fault = parseFault(value(++i, 'a fault'));
    else if (a === '--plugin') out.plugin = path.resolve(value(++i, 'a plugin checkout'));
    else throw new Error(`unknown argument: ${a}`);
  }
  return out;
}

// The server that serves the boards: this checkout's, or with --plugin the one of another
// checkout of the plugin (an older one, to prove a board written for this plugin opens on it).
function serverScriptOf(pluginDir) {
  const script = path.join(pluginDir || path.join(__dirname, '..', '..', '..', '..'), 'skills', 'web', 'scripts', 'server.js');
  if (!fs.existsSync(script)) throw new Error(`no server at ${script}`);
  return script;
}

// The scenarios to run, in the registry's order (last to first with --reverse).
function selectScenarios(all, { only = [], reverse = false } = {}) {
  const known = all.map((s) => s.name);
  for (const n of only) {
    if (!known.includes(n)) throw new Error(`unknown scenario '${n}': ${known.join(', ')}`);
  }
  const picked = only.length ? all.filter((s) => only.includes(s.name)) : all.slice();
  return reverse ? picked.reverse() : picked;
}

// --- Chrome ------------------------------------------------------------------------

// The sandbox goes only when it has to: for root, or when the environment says
// so (a CI user whose kernel refuses Chrome's sandbox). A local run keeps it.
function noSandboxWanted(env, uid) {
  const v = String((env && env.KANBAN_BROWSER_NO_SANDBOX) || '').toLowerCase();
  return uid === 0 || (v !== '' && v !== '0' && v !== 'false');
}

function chromeArgs({ cdpPort, profileDir, env = process.env, uid = typeof process.getuid === 'function' ? process.getuid() : undefined }) {
  const args = ['--headless=new', '--disable-gpu', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profileDir}`,
    '--window-size=1600,1000', '--no-first-run', '--no-default-browser-check'];
  if (noSandboxWanted(env, uid)) args.push('--no-sandbox');
  args.push('about:blank');
  return args;
}

// --- input -------------------------------------------------------------------------

const MODIFIER_BITS = { alt: 1, ctrl: 2, meta: 4, shift: 8 };

// key name -> [windowsVirtualKeyCode, code, text typed when pressed alone]
const NAMED_KEYS = {
  Escape: [27, 'Escape'], Enter: [13, 'Enter', '\r'], Tab: [9, 'Tab'], Backspace: [8, 'Backspace'], Delete: [46, 'Delete'],
  ArrowLeft: [37, 'ArrowLeft'], ArrowUp: [38, 'ArrowUp'], ArrowRight: [39, 'ArrowRight'], ArrowDown: [40, 'ArrowDown'],
  Home: [36, 'Home'], End: [35, 'End'], PageUp: [33, 'PageUp'], PageDown: [34, 'PageDown'],
  ContextMenu: [93, 'ContextMenu'], F10: [121, 'F10'], ' ': [32, 'Space', ' '],
};

// printable character -> [windowsVirtualKeyCode, code of the physical key]
const PUNCTUATION = {
  '/': [191, 'Slash'], '?': [191, 'Slash'], '[': [219, 'BracketLeft'], ']': [221, 'BracketRight'], '{': [219, 'BracketLeft'], '}': [221, 'BracketRight'],
  '.': [190, 'Period'], ',': [188, 'Comma'], ';': [186, 'Semicolon'], ':': [186, 'Semicolon'], '-': [189, 'Minus'], '=': [187, 'Equal'],
  '#': [51, 'Digit3'], '@': [50, 'Digit2'], '|': [220, 'Backslash'], '"': [222, 'Quote'], "'": [222, 'Quote'], '*': [56, 'Digit8'],
};

// The Input.dispatchKeyEvent calls for one key press. A key held with ctrl, meta
// or alt types no text, as in a real browser; one held with shift does.
function keyEvents(key, mods = {}) {
  let vk; let code; let text;
  if (NAMED_KEYS[key]) [vk, code, text] = NAMED_KEYS[key];
  else if (/^[a-zA-Z]$/.test(key)) { vk = key.toUpperCase().charCodeAt(0); code = `Key${key.toUpperCase()}`; text = key; }
  else if (/^[0-9]$/.test(key)) { vk = key.charCodeAt(0); code = `Digit${key}`; text = key; }
  else if (PUNCTUATION[key]) { [vk, code] = PUNCTUATION[key]; text = key; }
  else throw new Error(`unknown key '${key}'`);
  const modifiers = Object.keys(MODIFIER_BITS).reduce((n, m) => n + (mods[m] ? MODIFIER_BITS[m] : 0), 0);
  const typesText = text !== undefined && !mods.ctrl && !mods.meta && !mods.alt;
  const down = { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, modifiers };
  if (typesText) down.text = text;
  return [down, { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, modifiers }];
}

// A right-click, as an expression for Runtime.evaluate: a synthetic contextmenu
// event dispatched at an element (its middle, or `point`), because a real
// right-button press fires contextmenu at different moments on different
// systems. Answers false when the element is not there.
function contextMenuExpr(selector, point) {
  const at = point ? `{x:${Number(point.x)},y:${Number(point.y)}}` : 'null';
  return `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return false;const r=e.getBoundingClientRect();`
    + `const p=${at}||{x:r.left+r.width/2,y:r.top+r.height/2};`
    + `e.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2,buttons:2,clientX:p.x,clientY:p.y,view:window}));return true})()`;
}

// --- processes and temporary folders ---------------------------------------------------

function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

// Kills a child and everything it started. A child spawned detached leads its
// own process group on POSIX, so the group goes even when the leader is already
// dead and its helpers (Chrome's renderers) are orphans.
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

function removeDir(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); } catch (e) { /* reported by the caller */ }
  return !fs.existsSync(dir);
}

// Everything a run starts is registered here, so one call ends it all: the
// server of each board, Chrome, and the temporary folders holding the boards'
// copies and Chrome's profile.
function createRegistry({ tmpBase = os.tmpdir() } = {}) {
  const recs = [];
  const dirs = [];
  let cleaning = null;

  function track(name, child) {
    const rec = { name, child, out: '' };
    const grab = (d) => { rec.out = (rec.out + d).slice(-4000); };
    if (child.stdout) child.stdout.on('data', grab);
    if (child.stderr) child.stderr.on('data', grab);
    rec.exited = new Promise((resolve) => {
      child.once('exit', (code, signal) => resolve(signal ? `killed by ${signal}` : `exited with code ${code}`));
      child.once('error', (e) => resolve(`failed to start: ${e.message}`));
    });
    recs.push(rec);
    return rec;
  }

  return {
    recs,
    find: (name) => recs.find((r) => r.name === name),
    spawn(name, cmd, args, opts = {}) {
      return track(name, spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], detached: !IS_WIN, windowsHide: true, ...opts }));
    },
    tmpDir(prefix) {
      const dir = fs.mkdtempSync(path.join(tmpBase, prefix));
      dirs.push(dir);
      return dir;
    },
    // Stops everything and answers what it could not: an empty list is a clean end.
    cleanup() {
      if (cleaning) return cleaning;
      cleaning = (async () => {
        const problems = [];
        for (const r of recs) killTree(r.child);
        for (const r of recs) {
          const pid = r.child.pid;
          const done = await Promise.race([r.exited.then(() => true), sleep(5000).then(() => false)]);
          if (!done && isAlive(pid)) problems.push(`${r.name} (pid ${pid}) is still running after cleanup`);
        }
        for (const d of dirs) if (!removeDir(d)) problems.push(`could not remove the temporary folder ${d}`);
        return problems;
      })();
      return cleaning;
    },
    // For process 'exit', where nothing may be awaited.
    cleanupSync() {
      for (const r of recs) killTree(r.child);
      for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* best effort */ } }
    },
  };
}

// --- starting Chrome -----------------------------------------------------------------

const CHROME_PAGE_MS = 20000;
const CHROME_STARTS = 2;
const CHROME_END_MS = 5000;
const CHROME_OUT_SHOWN = 1000;

const listTargets = async (port) => (await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(2000) })).json();

// Asks the DevTools port of a Chrome that was just started for its first page, until
// `ms` is up. A Chrome that stays up and never lists a page is the one failure of a
// start that can come back: its error names the port, says what the port answered
// and quotes what Chrome printed, and is marked noPageTarget so the start can be
// tried again. A Chrome that has exited is reported and not marked, since asking
// again would not bring it back.
async function waitForPageTarget({ rec, port, ms = CHROME_PAGE_MS, pollMs = 100, targets = listTargets }) {
  const t0 = Date.now();
  let heard = 'never answered';
  while (Date.now() - t0 < ms) {
    if (rec.child.exitCode !== null || rec.child.signalCode !== null) throw new Error(`Chrome exited early: ${rec.out}`);
    try {
      const list = await targets(port);
      const page = list.find((t) => t.type === 'page');
      if (page) return page;
      heard = `answered with ${list.length ? list.map((t) => t.type).join(', ') : 'no targets'}`;
    } catch (e) { /* not listening yet */ }
    await sleep(pollMs);
  }
  const printed = rec.out.trim() ? rec.out.trim().slice(-CHROME_OUT_SHOWN) : 'nothing';
  const err = new Error(`timed out waiting for Chrome to expose a page target: its DevTools port ${port} ${heard} in ${ms / 1000}s, and Chrome printed ${printed}`);
  err.noPageTarget = true;
  throw err;
}

// Waits, up to `ms`, until a child that killTree ended has been reaped. On POSIX a killed
// process stays listed until its exit is collected on a later turn of the event loop, so
// the signal having gone out does not yet mean the process is gone.
function reaped(rec, ms) {
  if (!rec.exited) return Promise.resolve();
  let timer;
  const late = new Promise((resolve) => { timer = setTimeout(resolve, ms); });
  return Promise.race([rec.exited, late]).finally(() => clearTimeout(timer));
}

// Starts Chrome, up to `starts` times, until one lists a page. `launch(n)` starts the
// n-th on a port and a profile of its own and answers { rec, port }. A Chrome that never
// lists a page is ended, and its exit awaited for up to `endMs`, before the next one
// starts or the run gives up, so two never share a machine and none is left listed.
async function startChromeUntilPage({ launch, starts = CHROME_STARTS, ms, pollMs, endMs = CHROME_END_MS, targets, log = console.log }) {
  for (let n = 1; ; n++) {
    const { rec, port } = await launch(n);
    try {
      return { rec, port, page: await waitForPageTarget({ rec, port, ms, pollMs, targets }) };
    } catch (e) {
      if (!e.noPageTarget) throw e;
      killTree(rec.child);
      await reaped(rec, endMs);
      if (n >= starts) throw e;
      log(`${e.message}; starting Chrome again (${n + 1} of ${starts})`);
    }
  }
}

// --- the scenario loop --------------------------------------------------------------

// A scenario is { name, board, timeoutMs?, run(page) }. The loop gives each one
// a fresh page on its own board, a timeout and a console-error check, and
// records whatever happens under its name: a throw, a hang and a lost browser
// are FAIL for that scenario, never an end to the run.
//
// `env` is the browser side, so the loop can be driven without one:
//   env.begin(scenario, ctx)  the page for this scenario; ctx has check() and scope
//   env.end(scenario, record) afterwards, also after a failure
//   env.consoleErrors()       console errors and exceptions since begin()
//   env.gone                  a promise that resolves, with the reason, when Chrome is lost

const DEFAULT_TIMEOUT_MS = 30000;
const END_GRACE_MS = 5000;

const seconds = (ms) => `${ms / 1000}s`;

// The boards a scenario drives: the one it names, then any it also names.
const boardsOf = (sc) => [sc.board, ...(sc.alsoBoards || [])];

async function runOne(sc, env, opts, log) {
  const rec = { name: sc.name, board: sc.board, status: 'PASS', checks: [], error: null, ms: 0 };
  const scope = { aborted: false };
  const check = (name, ok, detail) => {
    if (scope.aborted) return;
    rec.checks.push({ name, ok: !!ok });
    log(`${ok ? 'PASS' : 'FAIL'}  [${sc.name}] ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
  };
  const timeoutMs = sc.timeoutMs || opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  const t0 = Date.now();
  let timer;
  log(`== ${sc.name}  (board ${boardsOf(sc).join(', ')})`);
  const work = async () => {
    const lostAlready = await Promise.race([env.gone, Promise.resolve(null)]);
    if (lostAlready) throw new Error(`Chrome is gone: ${lostAlready}`);
    const page = await env.begin(sc, { check, scope });
    await sc.run(page);
    // A scenario that provokes an error answer on purpose (a refused save) names it in expectedErrors.
    const errs = (await env.consoleErrors()).filter((e) => !(sc.expectedErrors || []).some((re) => re.test(e)));
    check('no console errors or exceptions', errs.length === 0, errs);
  };
  const timedOut = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`timed out after ${seconds(timeoutMs)}`)), timeoutMs); });
  const lost = env.gone.then((why) => { throw new Error(`Chrome is gone: ${why}`); });
  try {
    await Promise.race([work(), timedOut, lost]);
  } catch (e) {
    rec.error = e && e.message ? e.message : String(e);
    log(`FAIL  [${sc.name}] scenario failed: ${rec.error}`);
  } finally {
    clearTimeout(timer);
    scope.aborted = true;
  }
  rec.ms = Date.now() - t0;
  rec.status = rec.error || rec.checks.some((c) => !c.ok) ? 'FAIL' : 'PASS';
  let graceTimer;
  const grace = new Promise((resolve) => { graceTimer = setTimeout(resolve, END_GRACE_MS); });
  await Promise.race([Promise.resolve().then(() => env.end(sc, rec)).catch(() => {}), grace]);
  clearTimeout(graceTimer);
  return rec;
}

// Runs the scenarios one after another, in the order given.
async function runScenarios(scenarios, env, opts = {}) {
  const log = opts.log || console.log;
  const results = [];
  for (const sc of scenarios) results.push(await runOne(sc, env, opts, log));
  return results;
}

// The fault flag: the named scenario throws before it does anything, so the
// run can show that a throw is FAIL under its name and the rest still run.
function withFault(scenarios, fault) {
  if (!fault || fault.kind !== 'throw') return scenarios;
  if (!scenarios.some((s) => s.name === fault.scenario)) {
    throw new Error(`unknown scenario '${fault.scenario}': ${scenarios.map((s) => s.name).join(', ')}`);
  }
  return scenarios.map((s) => (s.name !== fault.scenario ? s : {
    ...s,
    run: async () => { throw new Error(`forced to fail by --fault throw:${s.name}`); },
  }));
}

// A run that ran nothing has not passed.
function exitCodeFor(results) {
  return results.length && results.every((r) => r.status === 'PASS') ? EXIT.OK : EXIT.FAILED;
}

function summaryLines(results) {
  const lines = ['', 'Scenarios'];
  const width = Math.max(10, ...results.map((r) => r.name.length));
  for (const r of results) {
    const note = r.error ? `  ${r.error}` : `  ${r.checks.length} checks`;
    lines.push(`${r.status}  ${r.name.padEnd(width)} ${seconds(r.ms).padStart(7)}${note}`);
  }
  const failed = results.filter((r) => r.status === 'FAIL').length;
  const checks = results.reduce((n, r) => n + r.checks.length, 0);
  lines.push(`${results.length - failed} passed, ${failed} failed (${results.length} scenarios, ${checks} checks)`);
  return lines;
}

module.exports = {
  EXIT, DEFAULT_TIMEOUT_MS, parseArgs, serverScriptOf, selectScenarios, noSandboxWanted, chromeArgs, keyEvents, contextMenuExpr,
  isAlive, killTree, createRegistry, sleep, boardsOf, waitForPageTarget, startChromeUntilPage,
  runScenarios, withFault, exitCodeFor, summaryLines,
};
